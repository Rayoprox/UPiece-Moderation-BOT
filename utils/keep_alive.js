const http = require('http');


const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot is running!');
});

server.listen(port, () => {
    console.log(`[KeepAlive] Web server is listening on port ${port}`);
});
