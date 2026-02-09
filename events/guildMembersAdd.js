const { Events } = require('discord.js');
const antiNuke = require('../utils/antiNuke.js');

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        
        await antiNuke.checkBotJoin(member);
    },
};
