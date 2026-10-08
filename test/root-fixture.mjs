export function fixture() {
  const operators = ["eq","ne","gt","gte","lt","lte","is_null","is_not_null"];
  const fields = [
    {id:"unrelated/ID-9",path:"id",label:"ID",type:"integer",encoding:"json",nullable:false,operators},
    {id:"title",path:"name",label:"Name",type:"string",encoding:"string",nullable:false,operators},
    {id:"price",path:"amount",label:"Amount",type:"decimal",encoding:"decimal-string",nullable:false,operators},
    {id:"flag",path:"active",label:"Active",type:"boolean",encoding:"json",nullable:false,operators:["eq","ne","is_null","is_not_null"]},
    {id:"optional",path:"note",label:"Note",type:"string",encoding:"string",nullable:true,operators},
    {id:"big",path:"large",label:"Large",type:"integer",encoding:"decimal-string",nullable:false,operators},
    {id:"day",path:"due",label:"Due",type:"date",encoding:"string",nullable:false,operators},
  ];
  const domain = {id:"items",fingerprint:"fp",publication:"scope-A"};
  const features = {format:"selecto.root-predicate-features",format_version:1,domain,profile:"canonical_root_predicates.v1",revision:"opaque-current",wire_profile:"remote_query.v2",request_format_version:2,result:{format:"selecto.remote-query-result",format_version:1},fields,default_select:fields.map((field) => field.id),limits:{max_limit:100,default_limit:100,max_offset:100000,default_offset:0,max_nodes:20,max_depth:4,root_depth:1,max_select:100,max_orders:10,max_string_utf8_bytes:16384,max_raw_request_bytes:1048576},supports:{where:true,and:true,or:true,flat_filters:false,nested:false,not:false,ranges:false,named_definitions:false,analytics:false}};
  const trusted = {domain,profile:features.profile,revision:features.revision,canonical_fields:fields.map(({path,type,encoding,nullable}) => ({path,type,encoding,nullable}))};
  const manifest = {format:"selecto.canonical-domain-api",format_version:1,domain:{fingerprint:"fp"},profiles:["remote_query.v1","remote_query.v2"],routes:[{operation_id:"queryDomain",method:"POST",path:"/api/items/query"},{operation_id:"getDomain",method:"GET",path:"/api/items/domain"},{operation_id:"getRootPredicateFeatures",method:"GET",path:"/api/items/features"}]};
  const binding = {domain_id:domain.id,fingerprint:domain.fingerprint,publication:domain.publication,wire_profile:features.wire_profile,feature_profile:features.profile,feature_revision:features.revision};
  const intent = {format:"selecto.root-predicate-ui-intent",format_version:1,mode:"recursive",binding,select:features.default_select.slice(),predicate:{kind:"tree",tree:{or:[{and:[{field:fields[0].id,op:"gte",value:"2"},{field:"flag",op:"eq",value:true}]},{field:"optional",op:"is_null"}]}},order_by:[{field:fields[0].id,direction:"asc"}],limit:2,offset:0,presentation:{timezone:"UTC",locale:"en-US"}};
  return {features,trusted,manifest,intent,context:{...trusted,features},state:{format:"selecto.root-predicate-state",format_version:1,intent}};
}
