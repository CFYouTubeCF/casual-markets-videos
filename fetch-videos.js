const https = require('https');
const fs = require('fs');

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

function fetchVideos(duration) {
  return new Promise((resolve, reject) => {
    const url = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${CHANNEL_ID}&part=snippet&order=date&maxResults=10&type=video&videoDuration=${duration}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const raw = JSON.parse(data);
          const videos = (raw.items || []).map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            description: item.snippet.description,
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

Promise.all([fetchVideos('medium'), fetchVideos('long')])
  .then(([medium, long]) => {
    const all = [...medium, ...long];
    const unique = all.filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
    const sorted = unique.sort((a, b) => new Date(b.published) - new Date(a.published));
    const top5 = sorted.slice(0, 5);
    fs.writeFileSync('videos.json', JSON.stringify(top5, null, 2));
    console.log('Saved', top5.length, 'videos');
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
