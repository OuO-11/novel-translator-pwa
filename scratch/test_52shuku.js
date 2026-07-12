async function test() {
  const url = 'https://www.52shuku.net/bl/b/bjLtz_2.html';
  console.log('Fetching', url);
  try {
    const response = await fetch('https://novel-translator-pwa.vercel.app/api/proxy?url=' + encodeURIComponent(url));
    const data = await response.json();
    const html = data.html;

    // a 태그 매칭 정규식: <a ...>text</a>
    const aRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    const links = [];
    while ((match = aRegex.exec(html)) !== null) {
      links.push({ href: match[1], text: match[2].replace(/<[^>]*>/g, '').trim() });
    }

    console.log('--- All pagination-like links in raw HTML ---');
    links.forEach(l => {
      if (l.text.includes('页') || l.text.includes('目') || l.text.includes('章') || l.text.includes('이전') || l.text.includes('다음')) {
        console.log(l);
      }
    });

  } catch (err) {
    console.error(err);
  }
}

test();
