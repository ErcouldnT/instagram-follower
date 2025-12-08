/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1334449381")

  // add field
  collection.fields.addAt(10, new Field({
    "cascadeDelete": true,
    "collectionId": "pbc_3789704380",
    "hidden": false,
    "id": "relation673688275",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "scan_id",
    "presentable": false,
    "required": true,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1334449381")

  // remove field
  collection.fields.removeById("relation673688275")

  return app.save(collection)
})
