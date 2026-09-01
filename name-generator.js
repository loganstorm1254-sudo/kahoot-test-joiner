const ADJECTIVES = [
  "Swift", "Brave", "Clever", "Misty", "Lucky", "Quiet", "Bold", "Happy",
  "Sunny", "Cosmic", "Neon", "Pixel", "Turbo", "Zesty", "Wild", "Fuzzy",
  "Icy", "Golden", "Silver", "Crimson", "Dizzy", "Chunky", "Spicy", "Wacky",
];

const NOUNS = [
  "Fox", "Tiger", "Hawk", "Wolf", "Panda", "Otter", "Lynx", "Koala",
  "Falcon", "Comet", "Nova", "Ninja", "Robot", "Penguin", "Dragon",
  "Badger", "Viper", "Moose", "Gecko", "Llama", "Crab", "Duck",
];

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomInt(max) {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return array[0] % max;
}

function randomChars(length) {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += CHARS[randomInt(CHARS.length)];
  }
  return result;
}

export function generateRandomName() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const style = randomInt(5);
    let name;

    if (style === 0) {
      name = `${ADJECTIVES[randomInt(ADJECTIVES.length)]}${NOUNS[randomInt(NOUNS.length)]}${randomInt(10000)}`;
    } else if (style === 1) {
      name = randomChars(5 + randomInt(6));
    } else if (style === 2) {
      name = `p${100000 + randomInt(899999)}`;
    } else if (style === 3) {
      name = `${ADJECTIVES[randomInt(ADJECTIVES.length)]}${randomChars(4)}`;
    } else {
      name = `${NOUNS[randomInt(NOUNS.length)]}${Date.now().toString().slice(-5)}`;
    }

    if (name.length >= 3 && name.length <= 15) {
      return name;
    }
  }

  return `p${Date.now().toString().slice(-10)}`;
}

export function generateUniqueNames(count) {
  const names = new Set();
  let attempts = 0;
  while (names.size < count && attempts < count * 100) {
    names.add(generateRandomName());
    attempts += 1;
  }
  while (names.size < count) {
    names.add(randomChars(10));
  }
  return [...names].sort(() => randomInt(3) - 1);
}
