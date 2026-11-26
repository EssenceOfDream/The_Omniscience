import hasBuiltProgram from './hasBuiltProgram.mjs';
import listPrograms from './listPrograms.mjs';
import getProgramIcon from './getProgramIcon.mjs';

export default async function (projectRoot, platform) {
  const programs = await listPrograms(projectRoot, platform);
  const apps = [];

  for (const program of programs) {
    if (program.category !== 'componentapps' && program.category !== 'webapps') continue;
    if (!await hasBuiltProgram(projectRoot, program.category, program.name)) continue;

    apps.push({
      id: program.name,
      type: program.category === 'componentapps' ? 'componentapp' : 'webapp',
      title: program.name,
      url: `/omniscience/${program.category}/${encodeURIComponent(program.name)}/index.html`,
      icon: await getProgramIcon(projectRoot, program.category, program.name),
      launchable: program.launchable,
      preloadPath: null,
    });
  }
  return apps;
}