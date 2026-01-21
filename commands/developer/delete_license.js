const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { error, success } = require('../../utils/embedFactory.js');
const { DEVELOPER_IDS } = require('../../utils/config.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('delete_license')
        .setDescription('Developer: Revoke/Delete a license from a server ID.')
        .addStringOption(option => 
            option.setName('server_id')
                .setDescription('The Guild ID (Server ID) to revoke the license from.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
  
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.editReply({ embeds: [error("Access Denied: Developer Only.")] });
        }

        const guildId = interaction.options.getString('server_id');

       
        const res = await db.query("SELECT * FROM licenses WHERE guild_id = $1", [guildId]);

        if (res.rows.length === 0) {
            return interaction.editReply({ embeds: [error(`No active license found for Server ID: \`${guildId}\`.`)] });
        }

        const licenseKey = res.rows[0].key;

        try {
            await db.query("DELETE FROM licenses WHERE guild_id = $1", [guildId]);
            
          
            
            await interaction.editReply({ embeds: [success(`License \`${licenseKey}\` revoked/deleted from Server \`${guildId}\`.`)] });

        } catch (err) {
            console.error(err);
            await interaction.editReply({ embeds: [error("Database error while deleting the license.")] });
        }
    },
};