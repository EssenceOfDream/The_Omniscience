import loadExtension from './loadExtension.mjs';
import listExtensions from './listExtensions.mjs';

export default async function(projectRoot) {
  const extensions = await listExtensions(projectRoot);
  return Promise.all(extensions.map(({ id }) =>
    loadExtension(projectRoot, id, { includeSources: true })));
}