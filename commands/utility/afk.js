const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/db.js');
const { success } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main', 
    isPublic: true, 
    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set your status as away (AFK).')
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('The reason for your absence.')
                .setRequired(false)),

    async execute(interaction) {
        const reason = interaction.options.getString('reason') || 'AFK';
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;

        try {
            await db.query(`
                INSERT INTO afk_users (userid, guildid, reason, timestamp) 
                VALUES ($1, $2, $3, $4) 
                ON CONFLICT (userid, guildid) DO UPDATE SET reason = $3, timestamp = $4
            `, [userId, guildId, reason, Date.now()]);

            await interaction.editReply({ 
                embeds: [success(`Your status is now AFK: **${reason}**.\n*Status will be removed when you speak.*`)] 
            });
            
        } catch (err) {
            console.error(err);
            if (!interaction.replied) {
                await interaction.editReply({ content: '❌ An error occurred while setting AFK.' });
            }
        }
    },
};