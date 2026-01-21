const { SlashCommandBuilder } = require('discord.js');
const db = require('../../utils/db.js');
const { success, error } = require('../../utils/embedFactory.js');

module.exports = {
    deploy: 'main',
    isPublic: true,
    data: new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Activate your bot license.')
        .addStringOption(o => o.setName('key').setDescription('UP-XXXX-...').setRequired(true)),

    async execute(interaction) {
        const key = interaction.options.getString('key').trim();
        const guildId = interaction.guild.id;

        const currentLicense = await db.query("SELECT * FROM licenses WHERE guild_id = $1", [guildId]);
        if (currentLicense.rows.length > 0) {
            return interaction.editReply({ embeds: [error('This server already has an active license.')] });
        }

        const res = await db.query("SELECT * FROM generated_licenses WHERE license_key = $1", [key]);

        if (res.rows.length === 0) {
            const checkActive = await db.query("SELECT * FROM licenses WHERE key = $1", [key]);
            if (checkActive.rows.length > 0) {
                return interaction.editReply({ embeds: [error('This key has already been redeemed.')] });
            }
            return interaction.editReply({ embeds: [error('Invalid Key.')] });
        }

        const licenseData = res.rows[0];
        let expiresAt = null;
        let typeStr = 'lifetime';

        if (licenseData.duration_days) {
            const days = parseInt(licenseData.duration_days);
            if (!isNaN(days) && days > 0) {
                expiresAt = Date.now() + (days * 24 * 60 * 60 * 1000);
                typeStr = `${days} days`;
            }
        }

        try {
            await db.query(
                "INSERT INTO licenses (key, guild_id, redeemed_by, created_at, expires_at, type) VALUES ($1, $2, $3, $4, $5, $6)",
                [key, guildId, interaction.user.id, Date.now(), expiresAt, typeStr]
            );

            await db.query("DELETE FROM generated_licenses WHERE license_key = $1", [key]);

            await interaction.editReply({ embeds: [success(`**License Activated!**\nExpires: ${expiresAt ? `<t:${Math.floor(expiresAt / 1000)}:R>` : 'Never'}`)] });

        } catch (err) {
            console.error(err);
            return interaction.editReply({ embeds: [error('An error occurred while activating the license.')] });
        }
    },
};  