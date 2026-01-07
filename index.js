
require('dotenv').config();


console.log(`--- BOT STARTING UP at ${new Date().toISOString()} ---`);

const { Client, Collection, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./utils/db.js'); // Ahora db se carga DESPUÉS de dotenv
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

// Loading de los comands
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

// event
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

// database
(async () => {
    try {
        await db.ensureTables();
        console.log('✅ All tables ensured in PostgreSQL.');
        
        client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
        console.error('❌ Failed to connect to database or login to Discord:', error);
    }
})();

// render
const PORT = process.env.PORT || 3000; 

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Discord Bot is Awake and Live!');
});

server.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT} for 24/7 heartbeat.`);

});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason);
    // No salir del proceso
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ Uncaught Exception:', error);
    // No salir del proceso
});