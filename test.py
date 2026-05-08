import requests

url = "http://localhost:8000/api/chat_stream"
payload = {
    "query": "What is the atomic weight of silicon?",
    "model": "hybrid"
}
res = requests.post(url, json=payload, stream=True)
for chunk in res.iter_lines():
    print(chunk.decode())