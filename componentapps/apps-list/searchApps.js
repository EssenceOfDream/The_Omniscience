function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
}

export function matchesAppSearch(app, query) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const searchableText = [
    app.title,
    app.id,
    app.fullPath,
    app.comment,
    app.categories,
  ].map(normalizeSearchText).join(' ');

  return terms.every((term) => searchableText.includes(term));
}

export function filterApps(apps, filter, query) {
  return apps.filter((app) => {
    if (filter === 'uwp') {
      if (app.launchType !== 'uwp') return false;
    } else if (filter === 'native') {
      if (app.kind !== 'native' || app.launchType === 'uwp') return false;
    } else if (filter !== 'all' && app.kind !== filter) {
      return false;
    }

    return matchesAppSearch(app, query);
  });
}

export function groupAppsByFirstLetter(apps) {
  const groups = new Map();

  for (const app of apps) {
    const title = String(app.title || app.id || '').trim();
    const firstCharacter = title.charAt(0).toLocaleUpperCase();
    const letter = /[A-ZА-ЯЁ]/.test(firstCharacter) ? firstCharacter : '#';

    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(app);
  }

  return Array.from(groups, ([letter, items]) => ({ letter, items }));
}
