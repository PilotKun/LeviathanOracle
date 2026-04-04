const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require('discord.js');
const db = require('../../schemas/db');
const { embed } = require('../../functions/ui');
const { getMALUser, getAniListUser } = require('../../utils/API-services');
const tracer = require('../../utils/tracer');

// ── Constants & State ────────────────────────────────────────────────────────
const VERIFY_TTL = 10 * 60 * 1000;
const pendingVerifications = new Map();

function verificationContext(type) {
  return `VERIFICATION: ${type === 'anilist' ? 'Anilist' : 'MAL'}`;
}

async function verifyMALUser(username) {
  try {
    const profile = await getMALUser(username);
    return {
      valid: !!profile,
      username: profile?.username || username,
      profile: profile || null,
    };
  } catch {
    return { valid: false, username, profile: null };
  }
}

async function verifyAniListUser(username) {
  try {
    const profile = await getAniListUser(username);
    return {
      valid: !!profile,
      username: profile?.name || username,
      profile: profile || null,
    };
  } catch {
    return { valid: false, username, profile: null };
  }
}

const PLATFORMS = {
  mal: {
    label: 'MyAnimeList',
    editUrl: 'https://myanimelist.net/editprofile.php',
    verify: verifyMALUser,
    fetch: getMALUser,
  },
  anilist: {
    label: 'AniList',
    editUrl: 'https://anilist.co/settings',
    verify: verifyAniListUser,
    fetch: getAniListUser,
  }
};

// ── Token Management ─────────────────────────────────────────────────────────
function getOrGenerateToken(userId, type, username) {
  const key = `${userId}:${type}:${username.toLowerCase()}`;
  const existing = pendingVerifications.get(key);

  if (existing && Date.now() < existing.expiresAt) return existing.token;

  const token = `LORA-${userId.slice(-4)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  pendingVerifications.set(key, { token, expiresAt: Date.now() + VERIFY_TTL });
  return token;
}

// ── Subcommand Handler ───────────────────────────────────────────────────────
async function handleLink(interaction) {
  const type = interaction.options.getSubcommand();
  const username = interaction.options.getString('username');
  const userId = interaction.user.id;
  const platform = PLATFORMS[type];

  const t = tracer.start(verificationContext(type), { userId, username });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    // 1. Validate account existence
    const account = await platform.verify(username);
    if (!account.valid) {
      return interaction.editReply({ 
        embeds: [embed({ title: 'Not Found', desc: `No ${platform.label} account for **${username}**.`, color: 0xFF0000 })] 
      });
    }

    const canonicalName = account.username;
    const dbField = `${type}_username`;

    // 2. Check ownership in Database
    const { rows } = await db.query(
      `SELECT user_id FROM user_profiles WHERE LOWER(${dbField}) = LOWER($1)`,
      [canonicalName]
    );

    const existingOwner = rows[0]?.user_id;

    if (existingOwner && existingOwner !== userId) {
      return interaction.editReply({ 
        embeds: [embed({ title: 'Already Claimed', desc: `This account belongs to another user.`, color: 0xFF0000 })] 
      });
    }

    // 3. Skip verification if already owned
    if (existingOwner === userId) {
      t.info('Re-linked existing ownership');
      return finishLink(interaction, type, canonicalName, true);
    }

    // 4. Token Verification Logic
    const token = getOrGenerateToken(userId, type, canonicalName);
    const userProfile = await platform.fetch(canonicalName, { fresh: true }).catch(() => account.profile || null);
    const aboutText = String(userProfile?.about || '');
    const isVerified = aboutText.toUpperCase().includes(token.toUpperCase());

    if (!isVerified) {
      t.info('Verification token issued');
      return interaction.editReply({
        embeds: [embed({
          title: '🔐 Ownership Verification',
          desc: `To link **${canonicalName}**, add this token to your **About** section:\n\n` +
                `**Token:** \`${token}\`\n\n` +
                `[Edit your ${platform.label} Bio](${platform.editUrl})\n\n` +
                `-# Run this command again once updated.`,
          color: 0xFFAA00
        })]
      });
    }

    // 5. Success
    await finishLink(interaction, type, canonicalName);
    pendingVerifications.delete(`${userId}:${type}:${canonicalName.toLowerCase()}`);
    t.end('Linked successfully');

  } catch (err) {
    t.error('Link Error', err);
    await interaction.editReply('An error occurred. Please try again.');
  }
}

async function finishLink(interaction, type, username, isUpdate = false) {
  const dbField = `${type}_username`;
  await db.query(
    `INSERT INTO user_profiles (user_id, ${dbField}) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET ${dbField} = EXCLUDED.${dbField}`,
    [interaction.user.id, username]
  );

  return interaction.editReply({
    embeds: [embed({
      title: isUpdate ? '✅ Connection Updated' : '✅ Profile Linked',
      desc: `Successfully connected to **${username}** on ${PLATFORMS[type].label}. You may now remove the verification token from your profile.`,
      color: 0x00FF00
    })]
  });
}

// ── Module Export ────────────────────────────────────────────────────────────
module.exports = {
  data: new SlashCommandBuilder()
    .setName('linkprofile')
    .setDescription('Link your anime tracking accounts')
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
    .addSubcommand(s => s
      .setName('mal')
      .setDescription('Link MyAnimeList')
      .addStringOption(o => o.setName('username').setRequired(true).setDescription('Username')))
    .addSubcommand(s => s
      .setName('anilist')
      .setDescription('Link AniList')
      .addStringOption(o => o.setName('username').setRequired(true).setDescription('Username'))),

  execute: handleLink
};
