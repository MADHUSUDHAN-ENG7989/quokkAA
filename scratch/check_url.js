const https = require('https');

const url = "https://quokka-xzwh.onrender.com";
console.log("Checking:", url);

https.get(url, (res) => {
  console.log("Status Code:", res.statusCode);
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log("Response Body:", data));
}).on('error', (err) => {
  console.error("Fetch Error:", err.message);
});
