require('dotenv').config();
const { initLogger } = require('./utils/logger.js');
const { Client, Collection, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./utils/db.js'); 
const http = require('http');


const PORT = process.env.PORT || 3000; 
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Live & Commands Auto-Updated');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ HTTP Server running on port ${PORT} (Render Health Check)`);
});


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
const commandsToDeploy = { main: [], appeal: [], global: [] };

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    

    if (!fs.lstatSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            
        
            if (command.deploy === 'main') {
                commandsToDeploy.main.push(command.data.toJSON());
            } else if (command.deploy === 'appeal') {
                commandsToDeploy.appeal.push(command.data.toJSON());
            } else if (command.deploy === 'all' || command.deploy === 'global') {
                commandsToDeploy.global.push(command.data.toJSON());
            }
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

async function autoDeployCommands() {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    console.log('🔄 Auto-Deploying commands to Discord API...');

    try {
     
        if (process.env.DISCORD_GUILD_ID && commandsToDeploy.main.length > 0) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
                { body: commandsToDeploy.main },
            );
            console.log(`✅ [Main Guild] ${commandsToDeploy.main.length} commands updated.`);
        }

  
        if (process.env.DISCORD_APPEAL_GUILD_ID && commandsToDeploy.appeal.length > 0) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_APPEAL_GUILD_ID),
                { body: commandsToDeploy.appeal },
            );
            console.log(`✅ [Appeal Guild] ${commandsToDeploy.appeal.length} commands updated.`);
        }

        
        if (commandsToDeploy.global.length > 0) {
            await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                { body: commandsToDeploy.global },
            );
            console.log(`✅ [Global] ${commandsToDeploy.global.length} commands updated.`);
        }
    } catch (error) {
        console.error('❌ Auto-Deploy Failed:', error);
    }
}

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

(async () => {
    try {
        console.log('🔄 Connecting to Database...');
        await db.ensureTables();
        
        await initLogger();
        
        await autoDeployCommands();

        console.log('🔄 Logging into Discord...');
        await client.login(process.env.DISCORD_TOKEN);
        
    } catch (error) {
        console.error('❌ Startup failed:', error);
    }
})();