import re
from flask import Flask, request, jsonify
from flask_cors import CORS
import requests

app = Flask(__name__)
# CORS 전면 허용 (프론트엔드 연동을 위함)
CORS(app, resources={r"/api/*": {"origins": "*"}})

@app.route('/api/proxy', methods=['GET'])
def proxy():
    url = request.args.get('url')
    if not url:
        return jsonify({"error": "Missing URL parameter"}), 400

    # 보안 및 차단 우회를 위한 헤더 기획
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,ko;q=0.7',
    }

    # 도메인별 Referer 조율 (CORS 우회 및 이미지 로딩 보장)
    if 'jjwxc' in url:
        headers['Referer'] = 'https://www.jjwxc.net/'
    elif '52shuku' in url:
        headers['Referer'] = 'https://www.52shuku.net/'
    elif 'archiveofourown' in url or 'ao3' in url:
        headers['Referer'] = 'https://archiveofourown.org/'
    elif 'pixiv' in url:
        headers['Referer'] = 'https://www.pixiv.net/'

    try:
        # 타겟 사이트 소스 긁어오기 (타임아웃 10초)
        response = requests.get(url, headers=headers, timeout=10)
        
        # 중국 사이트들의 구식 인코딩(GBK, GB2312) 깨짐 방지 처리
        content_type = response.headers.get('Content-Type', '').lower()
        
        # HTML 내용에 적혀있는 meta charset 감지
        charset_match = re.search(r'charset=["\']?([a-zA-Z0-9-_]+)', response.text, re.IGNORECASE)
        if charset_match:
            encoding = charset_match.group(1).lower()
        elif 'gbk' in content_type or 'gb2312' in content_type:
            encoding = 'gbk'
        else:
            # 기본적으로 apparent_encoding을 사용하거나 fallback으로 utf-8 지정
            encoding = response.apparent_encoding or 'utf-8'
            
        # 디코딩 수행
        html_content = response.content.decode(encoding, errors='replace')

        return jsonify({
            "html": html_content,
            "status": response.status_code,
            "url": response.url
        }), 200

    except requests.exceptions.Timeout:
        return jsonify({"error": "Target server timeout (10s limit)"}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Failed to fetch resource: {str(e)}"}), 502

# Vercel Serverless 에러 로깅 엔드포인트 추가 (프론트엔드 예외를 콘솔로 모니터링)
@app.route('/api/log_error', methods=['POST'])
def log_error():
    try:
        data = request.json or {}
        print("\n\n==================================================")
        print("🚨 [FRONTEND RUNTIME ERROR DETECTED]")
        print(f"🕒 Time   : {data.get('time')}")
        print(f"📖 Context: {data.get('context')}")
        print(f"💬 Message: {data.get('message')}")
        print(f"🔗 URL    : {data.get('url')}")
        print(f"📂 Stack  : {data.get('stack')}")
        print("==================================================\n\n")
        return jsonify({"status": "logged"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Vercel Serverless 실행을 위해 app 인스턴스 서빙
if __name__ == '__main__':
    app.run(port=5000, debug=True)

