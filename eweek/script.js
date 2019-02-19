var memes = [
  {
    pos:[-2,0],
    name="meme00.jpg"
  },
  {
    pos:[2,0],
    name="meme01.jpg"
  }
];

function addImage(image){
  var position = image.pos[0]+" "+image.pos[1]+" 0";
  $('<a-image />', {
    id: name,
    class: "",
    position: position,  // doesn't seem to do anything, known issue
    scale: "1 1 1",
    rotation: "-90 0 0",
    src: image.name,
    appendTo : $('#hiro-marker')
  });
  document.getElementById(id).setAttribute("position", position); // this does set position as a workaround
}

$(function(){
  memes.each(function(meme){
    console.log(meme);
  })
});
