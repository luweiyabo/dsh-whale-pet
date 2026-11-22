// DSH 内置语言包的其余语言词典（ja/es/fr/de/ru/pt）。
// 每个 JSON：{ strings, animNames, specialDescriptions, animDescTemplate }；
// 动作描述按 animDescTemplate + 译名生成，specialDescriptions 覆盖模板不适用的 3 条。
import de from './de.json';
import es from './es.json';
import fr from './fr.json';
import ja from './ja.json';
import pt from './pt.json';
import ru from './ru.json';

export default { de, es, fr, ja, pt, ru };
