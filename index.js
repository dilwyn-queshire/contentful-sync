var fs = require('fs');
var sentenceCase = require('sentence-case');
var matter = require('gray-matter');
var contentful = require('contentful');

function contentfulSync(options, cb) {
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
            cb('"' + path + '" is not a directory');
        }

        if (!exists) {
            fs.mkdirSync(path);
        }
    }

    function paramCase(str) {
        return sentenceCase(str, null, '-');
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
                    entryFiles: {},
                    entries: {},
                    assets: {}
                };
            }
            previousSyncData.nextSyncToken = syncData.nextSyncToken;

            function saveEntryToSyncData(entry) {
                var contentType = getContentType(entry);
                var data = getEntryData(entry, true);
                var entryFileName = getContentTypeEntryFileName(contentType, data);

                previousSyncData.entryFiles[entry.sys.id] = entryFileName;

                previousSyncData.entries[entry.sys.id] = entry;
            }

            function deleteEntryFromSyncData(deletedEntry) {
                delete previousSyncData.entryFiles[deletedEntry.sys.id];
                delete previousSyncData.entries[deletedEntry.sys.id];
            }

            function saveAssetToSyncData(asset) {
                previousSyncData.assets[asset.sys.id] = asset;
            }

            function deleteAssetFromSyncData(deletedAsset) {
                delete previousSyncData.assets[deletedAsset.sys.id]
            }

            function getContentType(entry) {
                var result = contentTypes.items.filter(function (contentType) {
                    return contentType.sys.id === entry.sys.contentType.sys.id;
                })[0];

                if (!result) throw 'contentType id=' + entry.sys.contentType.sys.id + ' not found';
                return result;
            }

            function getContentTypeDirectory(contentType) {
                return entriesDirectory + '/' + paramCase(contentType.name);
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

            function mapLinked(obj) {
                switch (obj.sys.type) {
                    case 'Asset':
                        return mapLinkedAsset(obj);
                    case 'Entry':
                        return mapLinkedEntry(obj);
                    case 'Link':
                        return mapLinkedLink(obj);
                }

                throw 'can not map obj "' + JSON.stringify(obj) + '"';
            }

            function mapLinkedLink(obj) {
                switch (obj.sys.linkType) {
                    case 'Entry':
                        var previousEntries = Object.keys(previousSyncData.entries).map(function(key, index) {
                            return previousSyncData.entries[key];
                        });

                        var entry = syncData.entries.concat(previousEntries).filter(function(entry) {
                            return entry.sys.id === obj.sys.id;
                        })[0];

                        if(!entry) throw 'linked entry id=' + obj.sys.id + ' not found';
                        return mapLinkedEntry(entry);

                    case 'Asset':
                        var previousAssets = Object.keys(previousSyncData.assets).map(function(key, index) {
                            return previousSyncData.assets[key];
                        });

                        var asset = syncData.assets.concat(previousAssets).filter(function(asset) {
                            return asset.sys.id === obj.sys.id;
                        })[0];

                        if(!asset) throw 'linked asset id=' + obj.sys.id + ' not found';
                        return mapLinkedAsset(asset);
                }

                throw 'can not map link "' + JSON.stringify(obj) + '"';
            }

            function mapLinkedEntry(entry) {
                var contentType = getContentType(entry);
                var data = getEntryData(entry, false);
                return {
                    id: data.id,
                    title: data[contentType.displayField]
                };
            }

            function mapLinkedAsset(asset) {
                return {
                    id: asset.sys.id,
                    title: asset.fields.title[defaultLocaleCode],
                    url: asset.fields.file[defaultLocaleCode].url
                };
            }

            function getEntryData(entry, resolveLinks) {
                var contentType = getContentType(entry);

                var data = {
                    id: entry.sys.id
                };

                (contentType.fields || []).forEach(function (field) {
                    var value = null;
                    var fieldData = entry.fields[field.id];

                    if (fieldData) {
                        fieldData = fieldData[defaultLocaleCode];
                        switch (field.type) {
                            case 'Array':
                                switch (field.items.type) {
                                    case 'Link':
                                        if(resolveLinks) {
                                            value = fieldData.map(function (item) {
                                                return mapLinked(item);
                                            });
                                        } else {
                                            value = fieldData.map(function (item) {
                                                return item.sys.id;
                                            });
                                        }
                                        break;
                                    default:
                                        value = fieldData;
                                        break;
                                }
                                break;
                            case 'Link':
                                value = mapLinked(fieldData);
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
                var contentTypeDirectory = entriesDirectory + '/' + paramCase(contentType.name);
                mkdirIfNotExists(contentTypeDirectory);
            });

            (syncData.entries || []).forEach(function (entry) {
                var contentType = getContentType(entry);
                var data = getEntryData(entry, true);

                var contentsKey = getContentTypeContentsKey(contentType);
                var entryFileName = getContentTypeEntryFileName(contentType, data);

                var yamlMatterContents = '';
                if (contentsKey) {
                    yamlMatterContents = data[contentsKey];
                    delete data[contentsKey];
                }

                var yamlMatterStr = matter.stringify(yamlMatterContents, data);
                fs.writeFileSync(entryFileName, yamlMatterStr);

                saveEntryToSyncData(entry);
            });

            (syncData.deletedEntries || []).forEach(function (deletedEntry) {
                if (!previousSyncData) throw 'previousSyncData is null';

                var entrylFileName = previousSyncData.entryFiles[deletedEntry.sys.id];
                fs.unlinkSync(entrylFileName);

                deleteEntryFromSyncData(deletedEntry);
            });

            (syncData.assets || []).forEach(function(asset) {
                saveAssetToSyncData(asset);
            });

            (syncData.deletedAssets || []).forEach(function(deletedAsset) {
                deleteAssetFromSyncData(deletedAsset);
            });

            return previousSyncData;
        })
        .then(function(data) {
            fs.writeFileSync(syncDataFile, JSON.stringify(data, null, 4));
        })
        .catch(function (error) {
            cb(error);
        });
}

module.exports = contentfulSync;

if (!module.parent) {
    var optionsStr = fs.readFileSync(process.argv[2], 'utf8');
    var options = JSON.parse(optionsStr);
    contentfulSync(options, function (err) {
        if(err) {
            console.error(err);
        } else {
            console.log('Import finished');
        }
    });
}
