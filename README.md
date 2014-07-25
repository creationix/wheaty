Wheaty
======

JS-Git based application hosting platform

## Development Usage

THe easiest way to use this is with the `wheaty` CLI tool.  To install this, simply do:

```sh
> npm install -g wheaty
```

Then when you want to test a site, just launch it by git url or path to local bare git repo.

```sh
> wheaty git://github.com/creationix/creationix.com.git
```

Then open your browser to <http://localhost:8080/> to see the site.

You override the port with the `PORT` environment variable.
The git branch can be changed with the `REF` environment variable.

If you want a custom prefix inside the repo, pass it as the second argument.

```sh
> wheaty git://github.com/creationix/blog.git www
```

## Production Usage

The `wheaty-group` tool can be used to create an instant git based PaaS.  Most the
creationix.com family of sites are running using this on a Rackspace server.
