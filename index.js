require('dotenv').config();

console.log(`--- BOT STARTING UP at ${new Date().toISOString()} ---`);
const http = require('http');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const db = require('./utils/db.js'); 
const { startScheduler, resumePunishmentsOnStart } = require('./utils/temporary_punishment_handler.js'); 

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

// Cargador de comandos
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

// Cargador de eventos
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

// Inicialización asíncrona
(async () => {
    try {
        // Asegurar tablas en la base de datos
        await db.ensureTables();
        console.log('✅ All tables ensured in PostgreSQL.');
        
        // Login en Discord
        await client.login(process.env.DISCORD_TOKEN);
        
        // Iniciar Dashboard Web
        const webApp = require('./web.js');
        
        // Pasar el cliente del bot a la web para que tenga acceso a los gremios/canales
        webApp.locals.botClient = client;

        // Iniciar el servidor web en el puerto especificado en el .env
        const PORT = process.env.PORT || 3001; 
        webApp.listen(PORT, () => {
            console.log(`🌐 Web dashboard running on port ${PORT}`);
        });

        // Iniciar el programador de sanciones temporales
        startScheduler(client);
        await resumePunishmentsOnStart(client);

    } catch (error) {
        console.error('❌ Failed to connect to database or login to Discord:', error);
    }
})();

// --- SISTEMA ANTI-CRASH ---
process.on('unhandledRejection', (reason, promise) => {
    // Ignorar errores comunes de WebSocket/Discord que no afectan al bot
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