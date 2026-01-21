const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const setupHome = require('../../interactions/admin/setup_sections/home.js'); 
const { safeDefer } = require('../../utils/interactionHelpers.js');
const { error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('🛠️ Open the server configuration panel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
       

        try {
           
            const { embed, components } = await setupHome.generateSetupContent(interaction, interaction.guild.id);

         
            const response = await interaction.editReply({ embeds: [embed], components: components });

            const collector = response.createMessageComponentCollector({ 
                filter: (i) => i.user.id === interaction.user.id, 
                idle: 60000 
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'idle') {
                    await interaction.deleteReply().catch(() => {}); 
                }
            });

        } catch (err) {
            console.error(err);
            await interaction.editReply({ embeds: [error('Failed to load setup panel.')] });
        }
    },
};