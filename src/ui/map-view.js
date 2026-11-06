// World map / level select screen (DOM). The model comes from src/game/progress.js;
// this file only builds elements (textContent only, never innerHTML).
import { starText } from '../game/score.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * Fill `root` with world cards. `model` from mapModel(), `sum` from totals().
 * opts: { onPick(index), onContinue(), onReset(), continueLabel, note }
 */
export function renderMap(root, model, sum, opts) {
  const head = el('div', 'map-head');
  const title = el('div', 'map-title');
  title.append(el('h2', '', 'Factory map'), el('p', 'map-total',
    `${sum.solved} of ${sum.count} jobs done · ${sum.stars} / ${sum.maxStars} ★`));
  const cont = el('button', 'primary', `▶ ${opts.continueLabel}`);
  cont.type = 'button';
  cont.id = 'map-continue';
  cont.onclick = opts.onContinue;
  head.append(title, cont);

  const grid = el('div', 'map-worlds');
  for (const w of model) {
    const card = el('section', `world-card${w.open ? '' : ' locked'}${w.built ? '' : ' upcoming'}`);
    card.setAttribute('aria-label', `World ${w.tag}: ${w.name}`);
    const h = el('h3');
    h.append(el('span', 'world-tag', w.tag), ` ${w.name}`);
    card.append(h, el('p', 'world-blurb', w.blurb));
    if (!w.built) {
      card.append(el('p', 'world-meta', 'Under construction — coming on a later shift.'));
    } else {
      card.append(el('p', 'world-meta', w.open ? `${w.solved}/${w.levels.length} done · ${w.stars}/${w.maxStars} ★`
        : 'Locked — finish earlier jobs to open it.'));
      const list = el('ol', 'level-tiles');
      for (const l of w.levels) {
        const b = el('button', `tile${l.won ? ' won' : ''}${l.current ? ' current' : ''}`);
        b.type = 'button';
        b.disabled = !l.open;
        b.title = l.open ? `${l.label} ${l.name}${l.won ? ` — ${starText(l.stars)}` : ''}` : `${l.label} is locked`;
        b.setAttribute('aria-label', l.open ? `${l.label} ${l.name}, ${l.won ? `${l.stars} of 3 stars` : 'not solved'}` : `${l.label} locked`);
        b.append(el('span', 'tile-num', l.label), el('span', 'tile-name', l.open ? l.name : '🔒'),
          el('span', 'tile-stars', l.won ? starText(l.stars) : l.open ? 'new' : ''));
        if (l.open) b.onclick = () => opts.onPick(l.index);
        const li = el('li');
        li.append(b);
        list.append(li);
      }
      card.append(list);
    }
    grid.append(card);
  }

  const foot = el('div', 'map-foot');
  if (opts.note) foot.append(el('p', 'map-note', opts.note));
  const reset = el('button', 'quiet', 'Reset progress…');
  reset.type = 'button';
  reset.onclick = opts.onReset;
  foot.append(reset);
  root.replaceChildren(head, grid, foot);
}
