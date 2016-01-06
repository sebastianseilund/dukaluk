# dukaluk

Say "Docker log" really fast! Dukaluk!

Monitors Docker start/stop events, attaches to containers, streams their output to Logstash.

Inspired by http://www.elastic.io/en/log-aggregation-for-docker-containers-in-mesos-marathon-cluster/

TODO

- Do we miss any events in the beginning between the Docker container starts and we actually attach from here?
- Should we continue to open a connection to Logstash for each container, or should we share a single one?
- Docs
- Tests
