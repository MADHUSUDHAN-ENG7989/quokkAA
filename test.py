import requests
import json

url = "https://quokka-xzwh.onrender.com/api/chat_stream"
payload = {
    "query": "What is the atomic weight of silicon?",
    "model": "hybrid"
}

headers = {
    "x-api-key": "qk_6fd3406ff9227aa6fd2477596be3b463"
}

res = requests.post(url, json=payload, headers=headers, stream=True)
for line in res.iter_lines():
    if line:
        decoded_line = line.decode('utf-8')
        if decoded_line.startswith('data: '):
            data_str = decoded_line[6:].strip()
            if not data_str:
                continue
            try:
                data = json.loads(data_str)
                if data.get('type') == 'sources':
                    print("Sources consulted:")
                    for src in data.get('sources', []):
                        print(f" - {src}")
                    print("\nAnswer: ", end='', flush=True)
                elif data.get('type') == 'chunk':
                    print(data.get('content', ''), end='', flush=True)
            except json.JSONDecodeError:
                pass
print()
    