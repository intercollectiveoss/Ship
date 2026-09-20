// ship
// designed and built by onyxpowered.
//
// `ship startup` -- the first thing a new install (or a returning one that
// wants to change its mind) should run. Two questions, both picked with
// arrow keys: which language, then how the daemon should run. The language
// question is the one place in the whole CLI that's deliberately shown in
// every supported language at once, since we don't know which one to use
// for it yet -- everything after it, including its own confirmation line,
// switches fully into whatever was picked.

import { LOCALES, saveLocale, loadLocale, localeName } from './Locale.js';
import { t } from './Strings.js';
import { printSuccess, printSystem } from './Output.js';
import { selectOption, createLineSource, SelectCancelled } from './Select.js';
import { installService } from './ServiceRegistration.js';
import { boot } from '../../../Platform.js';

const LANGUAGE_PROMPT_MULTILINGUAL =
  'choose your language / elige tu idioma / choisissez votre langue / scegli la tua lingua / ' +
  'wähle deine sprache / 言語を選択してください / 选择你的语言';
const ENTER_NUMBER_MULTILINGUAL =
  'enter a number / introduce un número / entrez un numéro / inserisci un numero / ' +
  'gib eine zahl ein / 番号を入力してください / 输入数字';

export async function runStartup(ctx = {}) {
  const { shipHome, nodePath, scriptPath, logPath } = ctx;

  const lineSource = ctx.lineSource ?? createLineSource();

  try {
    const languageIndex = await selectOption({
      header: LANGUAGE_PROMPT_MULTILINGUAL,
      options: LOCALES.map((locale) => locale.name),
      invalidMessage: ENTER_NUMBER_MULTILINGUAL,
      enterNumberLabel: ENTER_NUMBER_MULTILINGUAL,
      lineSource,
    });
    const locale = LOCALES[languageIndex].code;
    await saveLocale(shipHome, locale);
    printSuccess(t(locale, 'startup.languageConfirmed', { language: localeName(locale) }));

    const runModeIndex = await selectOption({
      header: t(locale, 'startup.runModeQuestion'),
      options: [t(locale, 'startup.runModeForeground'), t(locale, 'startup.runModeBackground')],
      invalidMessage: t(locale, 'startup.invalidChoice'),
      enterNumberLabel: t(locale, 'startup.enterNumber'),
      lineSource,
    });

    if (runModeIndex === 0) {
      printSystem(t(locale, 'startup.startingForeground'));
      const { readyReport } = await boot({ shipHome });
      printSuccess(t(locale, 'daemonStartForeground', { pid: process.pid, socket: readyReport.socket }));
      printSystem(t(locale, 'daemonStartForegroundHint'));
      return { locale, mode: 'foreground', readyReport };
    }

    printSystem(t(locale, 'startup.startingBackground'));
    const result = await installService({ nodePath, scriptPath, logPath, shipHome });
    printSuccess(t(locale, 'daemonInstallSuccess', { mechanism: result.mechanism }));
    printSuccess(t(locale, 'startup.done'));
    return { locale, mode: 'background', result };
  } catch (error) {
    if (error instanceof SelectCancelled) {
      // Whichever question was open when ctrl+c landed, we don't reliably
      // know the chosen locale yet (it could be the very first question) --
      // print the cancellation in whatever's already on disk from a
      // previous run, falling back to English.
      printSystem(t(await loadLocale(shipHome), 'cancelled'));
      return undefined;
    }
    throw error;
  } finally {
    lineSource.close();
  }
}
