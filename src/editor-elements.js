// Return a copy so a deletion can be validated before it enters undo history.
export function withoutSlideElement(slide, key) {
  const copy = structuredClone(slide), removed = new Set();
  if (key.startsWith('shape:')) {
    const id = key.slice(6);
    if (!copy.shapes?.some(shape => shape.id === id)) return null;
    copy.shapes = copy.shapes.filter(shape => shape.id !== id);
    if (!copy.shapes.length) delete copy.shapes;
    removed.add(id);
  } else if (key.startsWith('block:')) {
    const id = key.slice(6);
    if (!copy.blocks.some(block => block.id === id)) return null;
    removed.add(id);
    if (copy.layout === 'document') {
      const collect = node => {
        if (!node || typeof node === 'string') return;
        if (node.bind === 'title') throw new Error('見出しを含む要素は削除できません。');
        if (node.bind) removed.add(node.bind);
        if (node.image) removed.add(node.image);
        (node.children ?? []).forEach(collect);
      };
      const find = node => {
        if (!node || typeof node === 'string') return;
        if (node.bind === id || node.image === id) collect(node);
        else (node.children ?? []).forEach(find);
      };
      find(copy.document.tree);
      const members = node => {
        if (!node || typeof node === 'string') return [];
        return [node.bind && node.bind !== 'title' ? node.bind : node.image, ...(node.children ?? []).flatMap(members)].filter(Boolean);
      };
      const prune = node => {
        if (typeof node === 'string') return node;
        if (removed.has(node.bind) || removed.has(node.image)) return null;
        const hadChildren = node.children?.length;
        if (node.children) node.children = node.children.map(prune).filter(child => child !== null);
        // Removing the last item also removes its empty frame/decorations.
        if (node.reveal && removed.has(node.reveal)) {
          const target = members(node)[0];
          if (!target) return null;
          node.reveal = target;
        }
        if (hadChildren && !node.children.some(child => typeof child !== 'string' || child.trim())) return null;
        return node;
      };
      copy.document.tree = prune(copy.document.tree);
    }
    copy.blocks = copy.blocks.filter(block => !removed.has(block.id));
  } else if (key === 'note' && copy.note) {
    delete copy.note; removed.add('note');
  } else if (key === 'image' && copy.image) {
    delete copy.image;
  } else return null;

  copy.cues = copy.cues.filter(cue => !removed.has(cue.target));
  if (copy.placement) {
    delete copy.placement[key];
    for (const id of removed) delete copy.placement[`block:${id}`];
    if (!Object.keys(copy.placement).length) delete copy.placement;
  }
  const a = copy.animation;
  if (a) {
    if (a.targets) a.targets = a.targets.filter(id => !removed.has(id));
    if (a.blockedTargets) a.blockedTargets = a.blockedTargets.filter(id => !removed.has(id));
    if (a.verdicts) a.verdicts = a.verdicts.filter(item => !removed.has(item.target));
    if (a.links) {
      const destinations = (a.targets ?? copy.blocks.map(b => b.id)).slice(1);
      a.links = a.links.filter(item => destinations.includes(item.target));
    }
    if (a.type === 'flow' && a.targets.length < 2) copy.animation = { type: 'none' };
    if (a.type === 'limit' && copy.max === undefined && copy.blocks.length) a.limit = Math.min(a.limit, Math.max(...copy.blocks.map(b => b.value)));
  }
  return copy;
}
