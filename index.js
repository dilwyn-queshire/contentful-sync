var fs = require('fs');
var changeCase = require('change-case');
var matter = require('gray-matter');
var contentful = require('contentful');

var options = {
    accessToken: 'bc13a61de5c57f651b0964e819c2c5c69325835c5f0d5a59360cf814db5af05b',
    space: '1l8ci7f9k5d8',
    dataDirectory: './contentful-data',
    contentTypes: {
        Post: {
            //id: 'slug',
            contents: 'body'
        },
        Author: {},
        Category: {}
    }
};

var entriesDirectory = options.dataDirectory + '/entries';
var assetsDirectory = options.dataDirectory + '/assets';
var syncDataFile = options.dataDirectory + '/sync-data.json';

function mkdirIfNotExists(path) {
    var exists = false;
    var stats = null;
    try {
        stats = fs.statSync(path);
        exists = true;
    } catch (err) {
    }

    if (exists && !stats.isDirectory()) {
        throw '"' + path + '" is not a directory';
    }

    if (!exists) {
        fs.mkdirSync(path);
    }
}

mkdirIfNotExists(options.dataDirectory);
mkdirIfNotExists(entriesDirectory);
mkdirIfNotExists(assetsDirectory);

var previousSyncData = null;
try {
    var syncDataStats = fs.statSync(syncDataFile);
    if (syncDataStats.isFile()) {
        var syncDataStr = fs.readFileSync(syncDataFile, 'utf8');
        previousSyncData = JSON.parse(syncDataStr);
    } else {
        console.error('"' + syncDataFile + '" is not a file');
    }
} catch (err) {
}

var client = contentful.createClient({
    accessToken: options.accessToken,
    space: options.space,
    insecure: false
});

var spacePromise = client.getSpace();
var contentTypesPromise = client.getContentTypes();
var syncPromise = client.sync({
    initial: !previousSyncData,
    nextSyncToken: previousSyncData ? previousSyncData.nextSyncToken : null,
    resolveLinks: false
});

Promise.all([spacePromise, contentTypesPromise, syncPromise])
    .then(function (result) {
        var space = result[0];
        var contentTypes = result[1];
        var syncData = result[2];

        if(!previousSyncData) {
            previousSyncData = {
                nextSyncToken: null,
                entries: {}
            };
        }
        previousSyncData.nextSyncToken = syncData.nextSyncToken;

        function getContentType(entry) {
            var result = contentTypes.items.filter(function (contentType) {
                return contentType.sys.id === entry.sys.contentType.sys.id;
            })[0];

            if (!result) throw 'contentType id=' + entry.sys.contentType.sys.id + ' not found';
            return result;
        }

        function getContentTypeDirectory(contentType) {
            return entriesDirectory + '/' + changeCase.paramCase(contentType.name);
        }

        function getContentTypeEntryKey(contentType) {
            if (options.contentTypes && options.contentTypes[contentType.name] && options.contentTypes[contentType.name].id) {
                return options.contentTypes[contentType.name].id;
            }
            return 'id';
        }

        function getContentTypeContentsKey(contentType) {
            if (options.contentTypes && options.contentTypes[contentType.name] && options.contentTypes[contentType.name].contents) {
                return options.contentTypes[contentType.name].contents;
            }
            return null;
        }

        function getContentTypeEntryFileName(contentType, entryData) {
            var contentTypeDirectory = getContentTypeDirectory(contentType);
            var entryKey = getContentTypeEntryKey(contentType);
            return contentTypeDirectory + '/' + entryData[entryKey] + '.md';
        }

        function getEntryData(contentType, entry) {
            var data = {
                id: entry.sys.id
            };

            contentType.fields.forEach(function (field) {
                var value = null;
                var fieldData = entry.fields[field.id];

                if (fieldData) {
                    fieldData = fieldData[defaultLocaleCode];
                    switch (field.type) {
                        case 'Array':
                            switch (field.items.type) {
                                case 'Link':
                                    value = fieldData.map(function (item) {
                                        return item.sys.id;
                                    });
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

                    data[field.id] = value;
                }
            });

            return data;
        }

        var defaultLocaleCode = (space.locales || []).filter(function (locale) {
            return locale.default;
        })[0].code;

        (contentTypes.items || []).forEach(function (contentType) {
            var contentTypeDirectory = entriesDirectory + '/' + changeCase.paramCase(contentType.name);
            mkdirIfNotExists(contentTypeDirectory);
        });

        (syncData.entries || []).forEach(function (entry) {
            var contentType = getContentType(entry);
            var data = getEntryData(contentType, entry);

            var contentsKey = getContentTypeContentsKey(contentType);
            var entryFileName = getContentTypeEntryFileName(contentType, data);

            var yamlMatterContents = '';
            if (contentsKey) {
                yamlMatterContents = data[contentsKey];
                delete data[contentsKey];
            }

            var yamlMatterStr = matter.stringify(yamlMatterContents, data);
            fs.writeFileSync(entryFileName, yamlMatterStr);

            previousSyncData.entries[entry.sys.id] = entryFileName;
        });

        (syncData.deletedEntries || []).forEach(function (deletedEntry) {
            if (!previousSyncData) throw 'previousSyncData is null';

            var entrylFileName = previousSyncData.entries[deletedEntry.sys.id];
            fs.unlinkSync(entrylFileName);

            delete previousSyncData.entries[deletedEntry.sys.id];
        });

        return previousSyncData;
    })
    .then(function(data) {
        fs.writeFileSync(syncDataFile, JSON.stringify(data, null, 4));
    })
    .catch(function (error) {
        throw error;
    });
