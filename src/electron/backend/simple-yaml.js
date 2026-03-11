function parseScalar(raw) {
  const value = raw.trim();
  if (value === "") {
    return "";
  }

  if (value === "[]") {
    return [];
  }

  if (value === "{}") {
    return {};
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

function splitKeyValue(text) {
  const index = text.indexOf(":");
  if (index === -1) {
    return [text.trim(), ""];
  }

  const key = text.slice(0, index).trim();
  const value = text.slice(index + 1).trim();
  return [key, value];
}

function parse(text) {
  const root = {};
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let currentArrayKey = null;
  let currentArrayType = null;
  let currentArrayObject = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) {
      continue;
    }

    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();

    // Legacy filelistbuilder output keeps array items flush-left after
    // `downloads:` / `deletes:` instead of indenting them under the key.
    if (currentArrayKey && indent === 0 && line.startsWith("- ")) {
      const itemText = line.slice(2).trim();
      if (itemText.includes(":")) {
        const [key, value] = splitKeyValue(itemText);
        currentArrayType = "object";
        currentArrayObject = { [key]: parseScalar(value) };
        root[currentArrayKey].push(currentArrayObject);
      } else {
        currentArrayType = "scalar";
        currentArrayObject = null;
        root[currentArrayKey].push(parseScalar(itemText));
      }
      continue;
    }

    if (indent === 0) {
      currentArrayObject = null;

      if (line.endsWith(":")) {
        currentArrayKey = line.slice(0, -1).trim();
        root[currentArrayKey] = [];
        currentArrayType = null;
        continue;
      }

      const [key, value] = splitKeyValue(line);
      root[key] = parseScalar(value);
      currentArrayKey = null;
      currentArrayType = null;
      continue;
    }

    if (!currentArrayKey) {
      continue;
    }

    if (line.startsWith("- ")) {
      const itemText = line.slice(2).trim();
      if (itemText.includes(":")) {
        const [key, value] = splitKeyValue(itemText);
        currentArrayType = "object";
        currentArrayObject = { [key]: parseScalar(value) };
        root[currentArrayKey].push(currentArrayObject);
      } else {
        currentArrayType = "scalar";
        currentArrayObject = null;
        root[currentArrayKey].push(parseScalar(itemText));
      }
      continue;
    }

    if (currentArrayType === "object" && currentArrayObject) {
      const [key, value] = splitKeyValue(line);
      currentArrayObject[key] = parseScalar(value);
    }
  }

  return root;
}

function formatScalar(value) {
  if (typeof value === "string") {
    if (value === "" || /[:#\-\n]|^\s|\s$/.test(value)) {
      return JSON.stringify(value);
    }
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value == null) {
    return '""';
  }

  return String(value);
}

function stringify(value) {
  const lines = [];

  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      lines.push(`${key}:`);
      for (const item of entry) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item);
          if (entries.length === 0) {
            lines.push("  - {}");
            continue;
          }

          const [firstKey, firstValue] = entries[0];
          lines.push(`  - ${firstKey}: ${formatScalar(firstValue)}`);
          for (const [childKey, childValue] of entries.slice(1)) {
            lines.push(`    ${childKey}: ${formatScalar(childValue)}`);
          }
        } else {
          lines.push(`  - ${formatScalar(item)}`);
        }
      }
      continue;
    }

    lines.push(`${key}: ${formatScalar(entry)}`);
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  parse,
  stringify
};
