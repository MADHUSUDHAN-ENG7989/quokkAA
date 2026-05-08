import requests

url = "https://quokka-xzwh.onrender.com/api/chat_stream"
payload = {
    "query": "What is the atomic weight of silicon?",
    "model": "hybrid"
}
res = requests.post(url, json=payload, stream=True)
for chunk in res.iter_lines():
    print(chunk.decode())