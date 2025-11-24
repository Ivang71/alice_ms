testing

```bash
curl -G -H 'X-API-Key: api_key' --data-urlencode 'q=директор по продажам X5' http://localhost:3000/search -w '\n%{time_total}\n'
```

```bash
curl -G -H 'X-API-Key: api_key' --data-urlencode 'q=директор по продажам X5' https://international-streaming.sbs/search -w '\n%{time_total}\n'
```


run only via
```bash
yarn prod
```

