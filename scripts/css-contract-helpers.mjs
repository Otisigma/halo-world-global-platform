export function extractMediaBlock(source, condition) {
  const escaped = condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`@media\\s*\\(${escaped}\\)\\s*\\{`, "i").exec(source);
  if (!match) return "";
  let depth = 1;
  for (let index = match.index + match[0].length; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(match.index + match[0].length, index);
  }
  return "";
}

export function hasCssDeclaration(source, selector, property, value) {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*${escapedValue}\\s*(?:!important\\s*)?(?:;|$)`, "i");
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(",").some(candidate => candidate.trim() === selector)
      && declaration.test(match[2].trim())) return true;
  }
  return false;
}
