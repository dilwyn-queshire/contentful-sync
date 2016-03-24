var fs = require('fs');
var changeCase = require('change-case');
var matter = require('gray-matter');
var contentful = require('contentful');

var options = {
    accessToken: '0a8b3edce0196bb1f39dcc595084a58def2c45ce4c95c6cf953ef46d2a521d41',
    space: 'ncdrvjovuu7s',
    dataDirectory: './contentful-data',
    contentTypes: {
        Post: {
            id: 'slug',
            contents: 'body'
        },
        Author: {

        },
        Category: {

        }
    }
};

var entriesDirectory = options.dataDirectory + '/entries';
var assetsDirectory = options.dataDirectory + '/assets';

function mkdirIfNotExists(path) {
    var exists = false;
    var stats = null;
    try {
        stats = fs.statSync(path);
        exists = true;
    } catch (err) {
    }

    if(exists && !stats.isDirectory()) {
        throw '"' + path + '" is not directory';
    }

    if(!exists) {
        fs.mkdirSync(path);
    }
}

mkdirIfNotExists(options.dataDirectory);
mkdirIfNotExists(entriesDirectory);
mkdirIfNotExists(assetsDirectory);

var client = contentful.createClient({
    accessToken: options.accessToken,
    space: options.space,
    insecure: false
});

var spacePromise = client.getSpace();
var contentTypesPromise = client.getContentTypes();
var syncPromise = client.sync({
    initial: true,
    nextSyncToken: null,
    resolveLinks: true
});

Promise.all([spacePromise, contentTypesPromise, syncPromise])
    .then(function(result) {
        var space = result[0];
        var contentTypes = result[1];
        var syncData = result[2];

        var defaultLocaleCode = space.locales.filter(function(locale) { return locale.default; })[0].code;

        contentTypes.items.forEach(function(contentType) {
            var contentTypeDirectory = entriesDirectory + '/' + changeCase.paramCase(contentType.name);
            mkdirIfNotExists(contentTypeDirectory);
        });

        syncData.entries.forEach(function(entry) {
            var contentTypeId = entry.sys.contentType.sys.id;
            var contentType = contentTypes.items.filter(function (contentType) {
                return contentType.sys.id === contentTypeId;
            })[0];

            var entryHash = {
                id: entry.sys.id
            };
            contentType.fields.forEach(function(field) {
                var value = null;
                var fieldData = entry.fields[field.id];

                if(fieldData) {
                    fieldData = fieldData[defaultLocaleCode];
                    switch (field.type) {
                        case 'Array':
                            switch (field.items.type){
                                case 'Link':
                                    value = fieldData.map(function (item) { return item.sys.id; });
                                    break;
                                default:
                                    value = fieldData;
                                    break;
                            }
                            break;
                        case 'Link':
                            value = fieldData.sys.id;
                            break;
                        default:
                            value = fieldData;
                            break;
                    }

                    entryHash[field.id] = value;
                }
            });

            var contentTypeDirectory = entriesDirectory + '/' + changeCase.paramCase(contentType.name);

            var entryKey = 'id';
            var contentsKey = null;
            if(options.contentTypes && options.contentTypes[contentType.name]) {
                var contentTypeOptions = options.contentTypes[contentType.name];

                if(contentTypeOptions.id) {
                    entryKey = contentTypeOptions.id;
                }

                if(contentTypeOptions.contents) {
                    contentsKey = contentTypeOptions.contents;
                }
            }

            var yamlFileName = contentTypeDirectory + '/' + entryHash[entryKey] + '.md';

            var yamlMatterContents = '';
            if(contentsKey) {
                yamlMatterContents = entryHash[contentsKey];
                delete entryHash[contentsKey];
            }

            var yamlMatterStr = matter.stringify(yamlMatterContents, entryHash);
            fs.writeFileSync(yamlFileName, yamlMatterStr);
        });
    })
    .catch(function(error) {
       throw error;
    });
