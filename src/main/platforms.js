const path = require('path');
const net = require('./net');
const instances = require('./instances');
const { settings } = require('./store');

// ---------- Modrinth ----------

const MR = 'https://api.modrinth.com/v2';

const MR_TYPE_DIR = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };

function loadersForInstance(inst) {
  return { fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'], neoforge: ['neoforge'] }[inst?.loader] || [];
}

async function mrSearch({ query = '', type = 'mod', gameVersion, loader, sort = 'relevance', offset = 0, limit = 24, category }) {
  const facets = [[`project_type:${type}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader && loader !== 'vanilla' && (type === 'mod' || type === 'modpack')) {
    facets.push(loader === 'quilt' ? ['categories:quilt', 'categories:fabric'] : [`categories:${loader}`]);
  }
  if (category) facets.push([`categories:${category}`]);
  const params = new URLSearchParams({ query, facets: JSON.stringify(facets), index: sort, offset, limit });
  const data = await net.getJson(`${MR}/search?${params}`);
  return {
    total: data.total_hits,
    hits: data.hits.map((h) => ({
      platform: 'modrinth',
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      icon: h.icon_url,
      downloads: h.downloads,
      follows: h.follows,
      categories: h.display_categories || h.categories,
      updated: h.date_modified,
      type: h.project_type,
      gallery: h.gallery?.slice(0, 1) || [],
      color: h.color,
    })),
  };
}

async function mrProject(id) {
  const p = await net.getJson(`${MR}/project/${id}`);
  return {
    platform: 'modrinth',
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    body: p.body,
    icon: p.icon_url,
    downloads: p.downloads,
    followers: p.followers,
    categories: p.categories,
    type: p.project_type,
    gallery: (p.gallery || []).map((g) => g.url),
    links: { source: p.source_url, issues: p.issues_url, wiki: p.wiki_url, discord: p.discord_url, page: `https://modrinth.com/${p.project_type}/${p.slug}` },
    gameVersions: p.game_versions,
    loaders: p.loaders,
    clientSide: p.client_side,
  };
}

function mrMapVersion(v) {
  const primary = v.files.find((f) => f.primary) || v.files[0];
  return {
    platform: 'modrinth',
    id: v.id,
    projectId: v.project_id,
    name: v.name,
    number: v.version_number,
    type: v.version_type,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    date: v.date_published,
    downloads: v.downloads,
    file: primary && { url: primary.url, filename: primary.filename, sha1: primary.hashes.sha1, size: primary.size },
    dependencies: (v.dependencies || []).map((d) => ({ projectId: d.project_id, versionId: d.version_id, type: d.dependency_type })),
  };
}

async function mrVersions(projectId, { gameVersion, loaders } = {}) {
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  if (loaders?.length) params.set('loaders', JSON.stringify(loaders));
  const list = await net.getJson(`${MR}/project/${projectId}/version?${params}`);
  return list.map(mrMapVersion);
}

// ---------- CurseForge ----------

const CF = 'https://api.curseforge.com/v1';
const CF_CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945 };
const CF_CLASS_DIR = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks', 6945: 'datapacks' };
const CF_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const CF_LOADER_NAME = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const CF_SORT = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 };

// Key shipped with the build (src/main/curseforge.json, not in git); a key from settings overrides it.
function cfKey() {
  let bundled = '';
  try {
    bundled = require('./curseforge.json').apiKey || '';
  } catch {}
  const key = (settings.get().curseforgeKey || bundled).trim();
  if (!key) throw new Error('Для CurseForge нужен API-ключ: Настройки → Платформы (console.curseforge.com)');
  return key;
}

async function cf(pathname, opts = {}) {
  return net.getJson(`${CF}${pathname}`, {
    ...opts,
    headers: { 'x-api-key': cfKey(), Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  });
}

function cfCdnUrl(file) {
  if (file.downloadUrl) return file.downloadUrl;
  // Some authors disable third-party downloads; the CDN path is still predictable.
  const id = String(file.id);
  return `https://edge.forgecdn.net/files/${id.slice(0, -3)}/${Number(id.slice(-3))}/${encodeURIComponent(file.fileName)}`;
}

function cfMapMod(m) {
  return {
    platform: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    title: m.name,
    description: m.summary,
    author: m.authors?.[0]?.name,
    icon: m.logo?.thumbnailUrl || m.logo?.url,
    downloads: m.downloadCount,
    follows: m.thumbsUpCount,
    categories: (m.categories || []).map((c) => c.name),
    updated: m.dateModified,
    type: Object.entries(CF_CLASS).find(([, v]) => v === m.classId)?.[0] || 'mod',
    gallery: (m.screenshots || []).map((s) => s.url),
    links: { page: m.links?.websiteUrl, source: m.links?.sourceUrl, issues: m.links?.issuesUrl, wiki: m.links?.wikiUrl },
  };
}

async function cfSearch({ query = '', type = 'mod', gameVersion, loader, sort = 'relevance', offset = 0, limit = 24 }) {
  const params = new URLSearchParams({
    gameId: 432,
    classId: CF_CLASS[type],
    searchFilter: query,
    sortField: CF_SORT[sort] || 2,
    sortOrder: 'desc',
    index: offset,
    pageSize: limit,
  });
  if (gameVersion) params.set('gameVersion', gameVersion);
  if (loader && CF_LOADER[loader] && (type === 'mod' || type === 'modpack')) params.set('modLoaderType', CF_LOADER[loader]);
  const data = await cf(`/mods/search?${params}`);
  return { total: Math.min(data.pagination.totalCount, 10000), hits: data.data.map(cfMapMod) };
}

async function cfProject(id) {
  const [{ data: mod }, desc] = await Promise.all([cf(`/mods/${id}`), cf(`/mods/${id}/description`).catch(() => ({ data: '' }))]);
  return { ...cfMapMod(mod), body: desc.data, bodyIsHtml: true };
}

function cfMapFile(f, modId) {
  const loaders = f.gameVersions.map((g) => g.toLowerCase()).filter((g) => ['forge', 'fabric', 'quilt', 'neoforge'].includes(g));
  return {
    platform: 'curseforge',
    id: String(f.id),
    projectId: String(modId || f.modId),
    name: f.displayName,
    number: f.displayName,
    type: { 1: 'release', 2: 'beta', 3: 'alpha' }[f.releaseType],
    gameVersions: f.gameVersions.filter((g) => /^\d/.test(g)),
    loaders,
    date: f.fileDate,
    downloads: f.downloadCount,
    file: { url: cfCdnUrl(f), filename: f.fileName, size: f.fileLength, sha1: f.hashes?.find((h) => h.algo === 1)?.value },
    dependencies: (f.dependencies || []).map((d) => ({ projectId: String(d.modId), type: d.relationType === 3 ? 'required' : 'optional' })),
  };
}

async function cfVersions(modId, { gameVersion, loaders } = {}) {
  const params = new URLSearchParams({ pageSize: 50 });
  if (gameVersion) params.set('gameVersion', gameVersion);
  if (loaders?.length && CF_LOADER[loaders[0]]) params.set('modLoaderType', CF_LOADER[loaders[0]]);
  const data = await cf(`/mods/${modId}/files?${params}`);
  return data.data.map((f) => cfMapFile(f, modId));
}

// ---------- unified ----------

const search = (opts) => (opts.platform === 'curseforge' ? cfSearch(opts) : mrSearch(opts));
const project = (platform, id) => (platform === 'curseforge' ? cfProject(id) : mrProject(id));
const versions = (platform, id, opts) => (platform === 'curseforge' ? cfVersions(id, opts) : mrVersions(id, opts));

async function pickVersion(platform, projectId, inst) {
  const list = await versions(platform, projectId, { gameVersion: inst.gameVersion, loaders: loadersForInstance(inst) });
  return list.find((v) => v.type === 'release') || list[0] || null;
}

// Installs a project version into an instance, pulling in required dependencies.
async function install(instanceId, { platform, projectId, versionId, type = 'mod' }, task, seen = new Set()) {
  const inst = instances.get(instanceId);
  if (seen.has(projectId)) return;
  seen.add(projectId);
  let version;
  if (versionId) {
    version =
      platform === 'curseforge'
        ? cfMapFile((await cf(`/mods/${projectId}/files/${versionId}`)).data, projectId)
        : mrMapVersion(await net.getJson(`${MR}/version/${versionId}`));
  } else {
    version = await pickVersion(platform, projectId, inst);
  }
  if (!version?.file) throw new Error('Нет подходящей версии для этой сборки');

  const existing = await instances.listContent(instanceId, MR_TYPE_DIR[type] || 'mods').catch(() => []);
  if (existing.some((m) => m.projectId === projectId && m.versionId === version.id)) return;

  const dir = path.join(instances.gameDirOf(instanceId), MR_TYPE_DIR[type] || 'mods');
  task?.update(`Скачивание ${version.file.filename}`, -1);
  for (const old of existing.filter((m) => m.projectId === projectId)) {
    await instances.removeContent(instanceId, MR_TYPE_DIR[type] || 'mods', old.file);
  }
  await net.download({ url: version.file.url, path: path.join(dir, version.file.filename), sha1: version.file.sha1, size: version.file.size });
  const meta = await project(platform, projectId).catch(() => null);
  instances.recordContent(instanceId, version.file.filename, {
    source: platform,
    projectId,
    versionId: version.id,
    versionNumber: version.number,
    sha1: version.file.sha1,
    title: meta?.title,
    iconUrl: meta?.icon,
  });

  for (const dep of version.dependencies.filter((d) => d.type === 'required' && d.projectId)) {
    await install(instanceId, { platform, projectId: dep.projectId, versionId: platform === 'modrinth' ? dep.versionId : null, type }, task, seen).catch(
      (e) => task?.update(`Зависимость пропущена: ${e.message}`),
    );
  }
}

module.exports = {
  search,
  project,
  versions,
  install,
  mrMapVersion,
  cf,
  cfCdnUrl,
  CF_LOADER_NAME,
  CF_CLASS_DIR,
  loadersForInstance,
};
