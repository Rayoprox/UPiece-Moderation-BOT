const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../../utils/db.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('bypass')
        .setDescription('Whitelist a User/Bot ID from Anti-Nuke.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option => 
            option.setName('id')
                .setDescription('The ID to whitelist')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('action')
                .setDescription('Add or Remove')
                .setRequired(true)
                .addChoices(
                    { name: 'Add', value: 'add' },
                    { name: 'Remove', value: 'remove' }
                )),
    async execute(interaction) {
        // NO hacemos deferReply aquí porque interactionCreate.js ya lo hizo (Protección 15 min activada)
        
        const id = interaction.options.getString('id');
        const action = interaction.options.getString('action');
        const guildId = interaction.guild.id;

        if (action === 'add') {
            await db.query('INSERT INTO bot_whitelist (guildid, targetid) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, id]);
            await interaction.editReply({ content: `✅ ID \`${id}\` has been **added** to the Anti-Nuke whitelist.` });
        } else {
            await db.query('DELETE FROM bot_whitelist WHERE guildid = $1 AND targetid = $2', [guildId, id]);
            await interaction.editReply({ content: `🗑️ ID \`${id}\` has been **removed** from the whitelist.` });
        }
    },
};