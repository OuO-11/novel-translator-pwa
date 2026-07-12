async function test() {
  const url = 'https://www.52shuku.net/bl/b/bjLtz_2.html';
  console.log('Testing Parser without jsdom for', url);
  try {
    const response = await fetch('https://novel-translator-pwa.vercel.app/api/proxy?url=' + encodeURIComponent(url));
    const data = await response.json();
    const html = data.html;

    // article-content 클래스를 가진 article 혹은 div 추출
    const articleMatch = html.match(/<(article|div)[^>]*class=["\'][^"\']*article-content[^"\']*["\'][^>]*>([\s\S]*?)<\/\1>/i);
    if (!articleMatch) {
      console.log('Article content not found via RegExp!');
      return;
    }

    let contentHtml = articleMatch[2];
    console.log('Raw contentHtml Length:', contentHtml.length);

    // a 태그 제거 시뮬레이션
    let cleanHtml = contentHtml.replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '');

    // br 태그 줄바꿈화
    cleanHtml = cleanHtml.replace(/<br\s*\/?>/gi, '\n');

    // 모든 HTML 태그 제거
    let text = cleanHtml.replace(/<[^>]*>/g, ' ');
    const lines = text.split('\n');

    const paragraphsList = [];
    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed && trimmed.length >= 4 && !trimmed.startsWith('http') && isNaN(trimmed)) {
        paragraphsList.push(trimmed);
      }
    });

    console.log('Paragraphs Count:', paragraphsList.length);
    console.log('First 3 Paragraphs:', paragraphsList.slice(0, 3));
  } catch (err) {
    console.error(err);
  }
}

test();
