/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3789704380")

  // update field
  collection.fields.addAt(2, new Field({
    "hidden": false,
    "id": "autodate2341372968",
    "name": "created",
    "onCreate": true,
    "onUpdate": false,
    "presentable": false,
    "system": false,
    "type": "autodate"
  }))

  // update field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "autodate1130519967",
    "name": "updated",
    "onCreate": false,
    "onUpdate": true,
    "presentable": false,
    "system": false,
    "type": "autodate"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3789704380")

  // update field
  collection.fields.addAt(2, new Field({
    "hidden": false,
    "id": "autodate2341372968",
    "name": "created_at",
    "onCreate": true,
    "onUpdate": false,
    "presentable": false,
    "system": false,
    "type": "autodate"
  }))

  // update field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "autodate1130519967",
    "name": "updated_at",
    "onCreate": false,
    "onUpdate": true,
    "presentable": false,
    "system": false,
    "type": "autodate"
  }))

  return app.save(collection)
})
