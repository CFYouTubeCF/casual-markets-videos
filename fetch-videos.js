const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

// Install youtube-transcript
try {
  execSync('npm install youtube-transcript', { stdio: 'inherit' });
} catch(e) {
  console.log('Could not install youtube-transcript, will use title-based descriptions');
}

function fetchVideos(duration) {
  return new Promise((resolve, reject) => {
    const url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&channelId=${CHANNEL_ID}&part=snippet&order=date&maxResults=10&type=video&videoDuration=${duration}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const raw = JSON.parse(data);
          const videos = (raw.items || []).map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            thumbnail: item.snippet.thumbnails.high.url,
            published: item.snippet.publishedAt,
            url: `https://www.youtube.com/watch?v=${item.id.videoId}`
          }));
          resolve(videos);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchTranscript(videoId) {
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    const text = transcript
      .map(t => t.text)
      .join(' ')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.substring(0, 800);
  } catch(e) {
    console.log(`No transcript for ${videoId}: ${e.message}`);
    return null;
  }
}

function generateDescription(title, transcript) {
  return new Promise((resolve, reject) => {
    const context = transcript
      ? `Video title: "${title}"\n\nOpening transcript (first ~800 characters):\n${transcript}`
      : `Video title: "${title}"`;

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `Write a one-sentence description for a finance YouTube video.

${context}

Rules:
- One sentence only, maximum 20 words
- Based on the actual content, not just the title
- Sound like a real person wrote it, not an AI
- Have a clear point of view or mild opinion
- Use simple everyday words
- Short and punchy
- No em dashes
- No words like: pivotal, vital, groundbreaking, transformative, underscores, highlights, showcasing, fostering, exploring, delving, testament, landscape, crucial, significant
- No phrases like "get into", "take a look", "dive into", "break down", "shed light"
- No promotional tone
- Do not start with "This video"
- No exclamation marks

Bad example: "This video explores the transformative implications of oil markets, highlighting their crucial role."
Good example: "Oil prices move everything else, and this time the shift is coming from somewhere unexpected."

Output the sentence only. Nothing else.`
      }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const description = parsed.content[0].text.trim();
          resolve(description);
        } catch(e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const [medium, long] = await Promise.all([
    fetchVideos('medium'),
    fetchVideos('long')
  ]);

  const all = [...medium, ...long];
  const unique = all.filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
  const sorted = unique.sort((a, b) => new Date(b.published) - new Date(a.published));
  const top5 = sorted.slice(0, 5);

  console.log('Fetching transcripts and generating descriptions...');
  for (const video of top5) {
    const transcript = await fetchTranscript(video.id);
    console.log(`Transcript for "${video.title}": ${transcript ? transcript.substring(0, 80) + '...' : 'none'}`);
    video.description = await generateDescription(video.title, transcript);
    console.log(`Description: "${video.description}"`);
  }

  fs.writeFileSync('videos.json', JSON.stringify(top5, null, 2));
  console.log('Done. Saved', top5.length, 'videos.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
