const https = require('https');
const fs = require('fs');

const API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

const url = `https://www.googleapis.com/youtube/v3/search?key=${API_KEY}&channelId=${CHANNEL_ID}&part=snippet&order=date&maxResults=10&type=video&videoDuration=medium`;

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const raw = JSON.parse(data);
    const videos = raw.items.slice(0, 5).map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails.high.url,
      published: item.snippet.publishedAt,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }));
    fs.writeFileSync('videos.json', JSON.stringify(videos, null, 2));
    console.log('Saved', videos.length, 'videos');
  });
});
