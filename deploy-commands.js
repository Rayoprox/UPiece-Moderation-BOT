const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

// Verificación de seguridad
if (!process.env.DISCORD_TOKEN) {
    console.error("❌ Error: Falta DISCORD_TOKEN en las variables de entorno.");
    process.exit(1);
}

const mainGuildCommands = [];
const appealGuildCommands = [];
const globalCommands = []; 

const commandFolders = fs.readdirSync(path.join(__dirname, 'commands'));

for (const folder of commandFolders) {
    const commandFiles = fs.readdirSync(path.join(__dirname, 'commands', folder)).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const command = require(path.join(__dirname, 'commands', folder, file));
        if ('data' in command && 'execute' in command) {
            switch (command.deploy) {
                case 'main':
                    mainGuildCommands.push(command.data.toJSON());
                    break;
                case 'appeal':
                    appealGuildCommands.push(command.data.toJSON());
                    break;
                case 'all': 
                    globalCommands.push(command.data.toJSON());
                    break;
                default:
                    console.warn(`[WARNING] The command ${command.data.name} is missing a "deploy" property.`);
                    break;
            }
        }
    }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Started refreshing application (/) commands.');

        if (process.env.DISCORD_GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
                { body: mainGuildCommands },
            );
            console.log(`✅ Successfully reloaded ${mainGuildCommands.length} commands for MAIN guild.`);
        }

        if (process.env.DISCORD_APPEAL_GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_APPEAL_GUILD_ID),
                { body: appealGuildCommands },
            );
            console.log(`✅ Successfully reloaded ${appealGuildCommands.length} commands for APPEAL guild.`);
        }

        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: globalCommands },
        );
        console.log(`✅ Successfully reloaded ${globalCommands.length} GLOBAL commands.`);

    } catch (error) {
        console.error("❌ Error deploying commands:", error);
    } finally {
        // ESTA ES LA CLAVE: Forzamos el cierre del proceso para que no bloquee el deploy
        console.log(' Closing deploy script to release resources.');
        process.exit(0);
    }
})();