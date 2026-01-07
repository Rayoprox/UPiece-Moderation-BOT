const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

require('dotenv').config(); 
const TOKEN = process.env.CHAOS_TOKEN; 
const CLIENT_ID = process.env.CHAOS_CLIENT_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName('createchannels').setDescription('Create test channels').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('createroles').setDescription('Create test roles').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder().setName('testingprotection').setDescription('Run simulation').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

// Manejador de errores para evitar que el bot se apague si falla al responder
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.once('ready', async () => {
    console.log('😈 Chaos Bot is ready!');
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('😈 Slash commands registered.');
    } catch (e) {
        console.error('Error registering commands:', e);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'createchannels') {
        await interaction.deferReply();
        for (let i = 0; i < 10; i++) {
            await interaction.guild.channels.create({ name: `spam-channel-${i}` }).catch(() => {});
        }
        await interaction.editReply('✅ 10 Channels created.');
    }

    if (interaction.commandName === 'createroles') {
        await interaction.deferReply();
        for (let i = 0; i < 10; i++) {
            await interaction.guild.roles.create({ name: `spam-role-${i}` }).catch(() => {});
        }
        await interaction.editReply('✅ 10 Roles created.');
    }

    if (interaction.commandName === 'testingprotection') {
        await interaction.deferReply();
        
        // CORRECCIÓN: Filtramos para NO borrar el canal actual
        const channels = interaction.guild.channels.cache
            .filter(c => c.deletable && c.id !== interaction.channelId) // <--- ESTO ES NUEVO
            .first(5);
            
        const roles = interaction.guild.roles.cache
            .filter(r => r.editable && r.name !== '@everyone' && r.managed === false)
            .first(5);

        console.log(`😈 Attempting to delete ${channels.length} channels and ${roles.length} roles...`);

        const promises = [];
        channels.forEach(c => promises.push(c.delete().catch(e => console.log(`Failed to delete channel: ${e.message}`))));
        roles.forEach(r => promises.push(r.delete().catch(e => console.log(`Failed to delete role: ${e.message}`))));
        
        await Promise.all(promises);

        // Crear basura nueva para provocar más caos
        for (let i = 0; i < 5; i++) {
             interaction.guild.channels.create({ name: `nuke-test-${i}` }).catch(() => {});
             interaction.guild.roles.create({ name: `nuke-role-${i}` }).catch(() => {});
        }
        
        // Usamos catch por si acaso el canal muere por otra razón
        await interaction.editReply('💀 Simulation executed. Check your main bot logs!').catch(() => {});
    }
});

client.login(TOKEN);