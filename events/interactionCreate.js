const { Events } = require('discord.js');
const commandHandler = require('../handlers/commandHandler');
const componentHandler = require('../handlers/componentHandler');

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction) {
        if (!interaction) return;

        try {
        
            if (interaction.isChatInputCommand()) {
                await commandHandler(interaction);
                return;
            }

            
            if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
                await componentHandler(interaction);
                return;
            }

        } catch (error) {
            console.error('[FATAL INTERACTION ERROR]', error);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '❌ Fatal system error.', ephemeral: true });
                }
            } catch (e) { }
        }
    },
};