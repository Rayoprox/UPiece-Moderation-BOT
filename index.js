require('dotenv').config();

console.log(`--- BOT STARTING UP at ${new Date().toISOString()} ---`);

const { Client, Collection, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./utils/db.js'); 
const { startScheduler, resumePunishmentsOnStart } = require('./utils/temporary_punishment_handler.js'); 
const http = require('http');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildBans
    ],
    partials: [Partials.Channel, Partials.GuildMember, Partials.Message, Partials.User]
});

client.commands = new Collection();
client.db = db; 

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.warn(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}


const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args)); 
    }
}


(async () => {
    try {
        await db.ensureTables();
        console.log('✅ All tables ensured in PostgreSQL.');
        
        await client.login(process.env.DISCORD_TOKEN);
        
        const webApp = require('./web.js');
        
        webApp.locals.botClient = client;
    

        const WEB_PORT = process.env.WEB_PORT || 3001;
        webApp.listen(WEB_PORT, () => {
            console.log(`🌐 Web dashboard running on port ${WEB_PORT}`);
        });

    } catch (error) {
        console.error('❌ Failed to connect to database or login to Discord:', error);
    }
})();

const PORT = process.env.PORT || 3000; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is Awake and Live!');
});

server.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT} for 24/7 heartbeat.`);

});
process.on('unhandledRejection', (reason, promise) => {
    
    if (reason?.code === 10062 || reason?.code === 40060 || reason?.code === 10008) return;

    console.error(' [ANTI-CRASH] Unhandled Rejection:', reason);
    
});

process.on('uncaughtException', (err, origin) => {
    console.error(' [ANTI-CRASH] Uncaught Exception:', err);
    console.error('Origen:', origin);
});

process.on('uncaughtExceptionMonitor', (err, origin) => {
    console.error(' [ANTI-CRASH] Monitor:', err);
});