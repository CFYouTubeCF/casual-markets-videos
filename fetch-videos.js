const https = require('https');
const fs = require('fs');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

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

function generateDescription(title) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Write a one-sentence description for a finance YouTube video titled: "${title}"

Your description must follow ALL of these rules:
- One sentence, maximum 18 words
- Sound like a real person wrote it, not an AI
- Have a clear point of view or mild opinion
- Be specific to this exact video topic, not generic
- Use simple everyday words
- Short and punchy, not flowing or elaborate
- No em dashes
- No words like: pivotal, vital, groundbreaking, transformative, underscores, highlights, showcasing, fostering, exploring, delving, testament, landscape, crucial, significant
- No phrases like "get into", "take a look", "dive into", "break down", "shed light"
- No promotional tone whatsoever
- Do not start with "This video"
- Do not end with a question
- No exclamation marks

Bad example: "This video explores the transformative implications of oil markets, highlighting their crucial role in the global economy."
Good example: "Oil prices move everything else. Here is why that actually matters right now."

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

  console.log('Generating AI descriptions...');
  for (const video of top5) {
    video.description = await generateDescription(video.title);
    console.log(`"${video.title}" -> "${video.description}"`);
  }

  fs.writeFileSync('videos.json', JSON.stringify(top5, null, 2));
  console.log('Saved', top5.length, 'videos with descriptions');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
