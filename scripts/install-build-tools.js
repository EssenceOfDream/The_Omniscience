// scripts/install-build-tools.js
import { execSync } from 'child_process';
import os from 'os';

if (os.platform() === 'win32') {
  console.log('Обнаружена Windows. Попытка установки инструментов сборки C++...');
  try {
    // Запускаем установку vs_install глобально (может потребовать прав администратора)
    execSync('npm install --global vs_install', { stdio: 'inherit' });
    console.log('Инструменты сборки успешно установлены (или уже были установлены).');
  } catch (error) {
    console.error('Не удалось автоматически установить инструменты сборки.');
    console.error('Пожалуйста, установите Visual Studio Build Tools вручную:');
    console.error('https://visualstudio.microsoft.com/visual-cpp-build-tools/');
    console.error('При установке выберите рабочую нагрузку "Разработка классических приложений на C++".');
  }
} else {
  console.log('Пропуск установки инструментов сборки (не Windows).');
}