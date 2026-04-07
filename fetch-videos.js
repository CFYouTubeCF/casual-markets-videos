const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

try {
  execSync('npm install youtube-transcript', { stdio: 'inherit' });
} catch(e) {
  console.log('Could not install youtube-transcript');
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
            youtubeDescription: item.snippet.description,
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

function fetchViewCounts(videoIds) {
  return new Promise((resolve, reject) => {
    const ids = videoIds.join(',');
    const url = `https://www.googleapis.com/youtube/v3/videos?key=${YOUTUBE_API_KEY}&id=${ids}&part=statistics,snippet`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const raw = JSON.parse(data);
          const result = {};
          (raw.items || []).forEach(item => {
            result[item.id] = {
              views: parseInt(item.statistics.viewCount || 0),
              fullDescription: item.snippet.description
            };
          });
          resolve(result);
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function formatViews(count) {
  if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M views';
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K views';
  return count + ' views';
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
    return text.substring(0, 2000);
  } catch(e) {
    console.log(`No transcript for ${videoId}: ${e.message}`);
    return null;
  }
}

function cleanYoutubeDescription(desc) {
  if (!desc) return '';
  return desc
    .replace(/https?:\/\/\S+/g, '')
    .replace(/➡️|👉/g, '')
    .replace(/#\w+/g, '')
    .replace(/\n+/g, ' ')
    .replace(/disclaimer:[\s\S]*/i, '')
    .replace(/all illustrations[\s\S]*/i, '')
    .replace(/investing involves risk[\s\S]*/i, '')
    .replace(/the information provided[\s\S]*/i, '')
    .replace(/for business inquiries[\s\S]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 2500);
}

function generateDescription(title, youtubeDescription, transcript) {
  return new Promise((resolve, reject) => {
    const cleanDesc = cleanYoutubeDescription(youtubeDescription);

    const context = `Video title: "${title}"

YouTube description:
${cleanDesc}

${transcript ? `Opening transcript (first ~2000 characters):\n${transcript}` : ''}`;

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{
        role: 'user',
        content: `Write a one-sentence description for a finance YouTube video using the context below.

${context}

Rules:
- One sentence only, maximum 20 words
- Based on the actual content and specific topic, not just the title
- Sound like a real person wrote it, not an AI
- Have a clear point of view or mild opinion
- Use simple everyday words
- Short and punchy
- No em dashes
- No semicolons used as em dash replacements
- No words like: pivotal, vital, groundbreaking, transformative, underscores, highlights, showcasing, fostering, exploring, delving, testament, landscape, crucial, significant, navigating, stands as, serves as, at its core, it's worth noting
- No phrases like: "get into", "take a look", "dive into", "break down", "shed light", "here's what you need to know", "in today's landscape", "in conclusion", "dives deep"
- No promotional tone whatsoever
- Do not start with "This video"
- No exclamation marks

Bad example: "This video explores the transformative implications of oil markets, highlighting their crucial role in the global economy."
Good example: "Japan's slow financial collapse is the actual threat to your portfolio, not anything happening in America."

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
          resolve(parsed.content[0].text.trim());
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

  const videoIds = top5.map(v => v.id);
  const videoData = await fetchViewCounts(videoIds);

  top5.forEach(v => {
    const data = videoData[v.id] || {};
    v.views = formatViews(data.views || 0);
    v.fullDescription = data.fullDescription || v.youtubeDescription || '';
    delete v.youtubeDescription;
  });

  console.log('Fetching transcripts and generating descriptions...');
  for (const video of top5) {
    const transcript = await fetchTranscript(video.id);
    video.description = await generateDescription(video.title, video.fullDescription, transcript);
    delete video.fullDescription;
    console.log(`"${video.title}" -> ${video.views} -> "${video.description}"`);
  }

  fs.writeFileSync('videos.json', JSON.stringify(top5, null, 2));
  console.log('Done. Saved', top5.length, 'videos.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
