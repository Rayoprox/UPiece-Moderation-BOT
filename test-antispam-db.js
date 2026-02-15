const db = require('./utils/db.js');
require('dotenv').config();

async function testAntiSpamDB() {
    console.log('🧪 Testing Anti-Spam Database Configuration...\n');

    try {
        // Get all guild configs
        const res = await db.query('SELECT guildid, antispam FROM automod_protections ORDER BY guildid');
        
        if (res.rows.length === 0) {
            console.log('⚠️  No automod_protections records found in database');
            return;
        }

        console.log(`Found ${res.rows.length} guild(s) with automod_protections:\n`);

        for (const row of res.rows) {
            console.log(`Guild ID: ${row.guildid}`);
            console.log(`Antispam Config: ${JSON.stringify(row.antispam, null, 2)}`);
            
            if (!row.antispam) {
                console.log('⚠️  WARNING: antispam field is NULL or empty!\n');
            } else if (typeof row.antispam === 'string') {
                console.log('⚠️  WARNING: antispam is a string, should be object/JSON\n');
            } else {
                // Check each type
                const mps = row.antispam.mps || {};
                const repeated = row.antispam.repeated || {};
                const emoji = row.antispam.emoji || {};
                
                console.log('✅ Configuration status:');
                console.log(`   - MPS: ${mps.enabled ? '✅ ENABLED' : '❌ DISABLED'} (threshold: ${mps.threshold || 'not set'})`);
                console.log(`   - Repeated Chars: ${repeated.enabled ? '✅ ENABLED' : '❌ DISABLED'} (threshold: ${repeated.threshold || 'not set'})`);
                console.log(`   - Emoji Spam: ${emoji.enabled ? '✅ ENABLED' : '❌ DISABLED'} (threshold: ${emoji.threshold || 'not set'})`);
                console.log('');
            }
        }
    } catch (err) {
        console.error('❌ Database Error:', err.message);
    } finally {
        process.exit(0);
    }
}

testAntiSpamDB();
