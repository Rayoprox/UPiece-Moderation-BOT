const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const db = require('../../utils/db.js');
const { DEVELOPER_IDS } = require('../../utils/config.js');
const { error, success } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    data: new SlashCommandBuilder()
        .setName('delete_license')
        .setDescription('Developer Only: Delete an UNUSED license key.')
        .addStringOption(option => 
            option.setName('key')
                .setDescription('The license key to delete')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        if (!DEVELOPER_IDS.includes(interaction.user.id)) {
            return interaction.reply({ embeds: [error("Access Denied: Developer Only.")], ephemeral: true });
        }

        const key = interaction.options.getString('key');

        try {
     
            const result = await db.query("DELETE FROM generated_licenses WHERE license_key = $1 RETURNING license_key", [key]);

            if (result.rowCount === 0) {
                return interaction.reply({ embeds: [error(`Unused license key \`${key}\` not found.`)] });
            }

            await interaction.reply({ embeds: [success(`License key \`${key}\` deleted successfully.`)] });

        } catch (err) {
            console.error(err);
            await interaction.reply({ embeds: [error("Database error.")] });
        }
    },
};