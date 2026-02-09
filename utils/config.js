
require('dotenv').config();

const DEVELOPER_IDS = process.env.DEVELOPER_IDS 
    ? process.env.DEVELOPER_IDS.split(',').map(id => id.trim()) 
    : [];

const SUPREME_IDS = process.env.SUPREME_IDS 
    ? process.env.SUPREME_IDS.split(',').map(id => id.trim()) 
    : [];

module.exports = {
    DEVELOPER_IDS,
    SUPREME_IDS,
    STAFF_COMMANDS: [
        'ban', 'unban', 'softban', 'kick', 'mute', 'unmute', 
        'warn', 'warnings', 'void', 'modlogs', 'case', 
        'reason', 'whois', 'purge', 'lock', 'unlock', 
    , 'slowmode', 'afk', 'modstats', 'help'
    ],
   
    emojis: {
        success: '<:checkemoji:1427318689014874175>',
        error: '<:cross:1427318691627929610>',
        loading: '<a:loading:1427318696145064036>',
        info: 'ℹ️',

        warn: '<:warning:1427318722233893144>',
        mute: '<:mute:1427318698464772148>',
        ban: '<:ban:1427320234737406104>',
        kick: '👢',
        unban: '<:unban:1427321361738760233>',
        unmute: '<:unmute:1427321397515911229>',
        lock: '🔒',
        unlock: '🔓',
        void: '<:void:1427318813636165653>',
        
        user: '<:user:1427320097005109269>',
        moderator: '<:staff:1427318708279447632>',
        reason: '<:reason:1427320560559329371>',
        duration: '<:timer:1427318710053503057>',
        case_id: '<:caseID:1427318683876855999>',
        dm_sent: '<:DM:1427318693930602496>',
        channel: '<:channel:1427318686728851609>',
        role: '<:Role:1427318703946596423>',
        rules: '<:rules:1427318705918054492>'
    }
};
