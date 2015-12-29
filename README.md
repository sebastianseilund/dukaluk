# docker2log

Monitors Docker start/stop events, attaches to containers, streams their output to log files on disk.

Used with Marathon. Runs on all our Mesos slaves. Filebeat/Logstash picks up the log files and ships events to Elasticsearch.

No docs here, but see how it's used in [billy-infra](https://github.com/billysbilling/billy-infra).

TODO

- Do we miss any events in the beginning between the Docker container starts and we actually attach from here?
