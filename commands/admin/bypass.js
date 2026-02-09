const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/db.js');
const { moderation } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('bypass')
        .setDescription('Whitelist a User/Bot ID from Anti-Nuke.')
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
        const id = interaction.options.getString('id');
        const action = interaction.options.getString('action');
        const guildId = interaction.guild.id;

        let description;
        if (action === 'add') {
            await db.query('INSERT INTO bot_whitelist (guildid, targetid) VALUES ($1, $2) ON CONFLICT DO NOTHING', [guildId, id]);
            description = `ID \`${id}\` has been **added** to the Anti-Nuke whitelist.`;
        } else {
            await db.query('DELETE FROM bot_whitelist WHERE guildid = $1 AND targetid = $2', [guildId, id]);
            description = `ID \`${id}\` has been **removed** from the whitelist.`;
        }
        
        await interaction.editReply({ embeds: [moderation(description)] });
    },
};
