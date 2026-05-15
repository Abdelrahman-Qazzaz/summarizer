# start rabbitmq (macOS / homebrew)

npm run mq

# or use docker (recommended for portability)

docker run -p 5672:5672 -p 15672:15672 rabbitmq:3-management

# then:

npm run dev
